import jwt, {
  type Secret,
  type GetPublicKeyOrSecret,
  type JwtPayload,
  type VerifyOptions,
} from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UnauthorizedError } from 'http-errors-enhanced';
import ms from 'ms';
import { randomBytes } from 'crypto';
import type { Database } from './database/index.js';
import type { JwtMacKey } from './database/schema.js';
import { subSeconds, formatISO } from 'date-fns';
import { promisify } from 'util';

const verifyJwt: (
  tok: string,
  sec: Secret | GetPublicKeyOrSecret,
  opts: VerifyOptions & { complete?: false }
) => Promise<JwtPayload | string> = promisify(jwt.verify);

export class TokenManager {
  private signingKeyId: string | undefined;
  private signingKeyBytes: Buffer | undefined;
  readonly expiresInSeconds: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private db: Database,
    private issuer: string,
    private audience: string,
    private expiresIn: string
  ) {
    const expiresInMs = ms(expiresIn);
    this.expiresInSeconds = expiresInMs / 1000;
    this.cleanupInterval = setInterval(() => this.rotateKey(), expiresInMs);
  }

  private async rotateKey() {
    const key: JwtMacKey = {
      kid: uuidv4(),
      audience: this.audience,
      key_bytes: randomBytes(32),
      created_at: formatISO(new Date()),
    };
    this.signingKeyId = key.kid;
    this.signingKeyBytes = key.key_bytes;

    const removeBefore = formatISO(
      subSeconds(new Date(), this.expiresInSeconds * 2)
    );
    await Promise.all([
      this.db.insertInto('jwt_mac_key').values(key).execute(),
      this.db
        .deleteFrom('jwt_mac_key')
        .where('audience', '=', this.audience)
        .where('created_at', '<', removeBefore)
        .execute(),
    ]);
  }

  async initialize() {
    return this.rotateKey();
  }

  async generateToken(subject: string): Promise<string> {
    if (this.signingKeyBytes == null) {
      throw new Error('Cannot issue JWT, no key set');
    }
    return jwt.sign({}, this.signingKeyBytes, {
      subject,
      audience: this.audience,
      issuer: this.issuer,
      algorithm: 'HS256',
      expiresIn: this.expiresIn,
      jwtid: uuidv4(),
      keyid: this.signingKeyId,
    });
  }

  async validateToken(
    authToken: string
  ): Promise<{ subject: string; expiresAt: number }> {
    const decodedToken = await verifyJwt(
      authToken,
      (header, callback) =>
        process.nextTick(async () => {
          const kid = header.kid;
          const result =
            kid == null
              ? undefined
              : await this.db
                  .selectFrom('jwt_mac_key')
                  .select('key_bytes')
                  .where('kid', '=', kid)
                  .where('audience', '=', this.audience)
                  .executeTakeFirst();
          if (result == null) {
            return callback(new Error('No Key Found'));
          }
          callback(null, result.key_bytes);
        }),
      {
        issuer: this.issuer,
        audience: this.audience,
      }
    );

    if (typeof decodedToken === 'object' && decodedToken != null) {
      const { sub, exp } = decodedToken;
      return {
        subject: sub as string,
        expiresAt: exp as number,
      };
    }
    console.warn(`Missing subject in token ${JSON.stringify(decodedToken)}`);
    throw new UnauthorizedError('Invalid Token');
  }
}
