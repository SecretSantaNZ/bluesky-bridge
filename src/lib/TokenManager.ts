import jwt, {
  type Secret,
  type GetPublicKeyOrSecret,
  type JwtPayload,
  type VerifyOptions,
} from 'jsonwebtoken';
import { randomUUID } from 'crypto';
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

export class TokenManager<D extends Record<string, unknown>> {
  private signingKeyId: string | undefined;
  private signingKeyBytes: Buffer | undefined;
  readonly expiresInSeconds: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private db: Database,
    private issuer: string,
    private audience: string,
    private expiresIn: ms.StringValue
  ) {
    const expiresInMs = ms(expiresIn);
    this.expiresInSeconds = expiresInMs / 1000;
    this.cleanupInterval = setInterval(
      () => this.rotateKey(),
      Math.min(expiresInMs, ms('4 hours'))
    );
  }

  private async rotateKey() {
    const removeBefore = formatISO(
      subSeconds(new Date(), this.expiresInSeconds * 2)
    );
    await this.db
      .deleteFrom('jwt_mac_key')
      .where('audience', '=', this.audience)
      .where('created_at', '<', removeBefore)
      .execute();
    const keys = await this.db
      .selectFrom('jwt_mac_key')
      .selectAll()
      .where('audience', '=', this.audience)
      .orderBy('created_at', 'asc')
      .execute();

    const countAfter = formatISO(subSeconds(new Date(), this.expiresInSeconds));
    const keysInInterval = keys.filter((key) => key.created_at > countAfter);

    if (keysInInterval.length == 0) {
      const key: JwtMacKey = {
        kid: randomUUID(),
        audience: this.audience,
        key_bytes: randomBytes(32),
        created_at: formatISO(new Date()),
      };
      await this.db.insertInto('jwt_mac_key').values(key).execute();
      keys.push(key);
    }
    const key = keys.pop() as JwtMacKey;
    this.signingKeyId = key.kid;
    this.signingKeyBytes = key.key_bytes;
  }

  async initialize() {
    return this.rotateKey();
  }

  async generateToken(subject: string, data: D): Promise<string> {
    if (this.signingKeyBytes == null) {
      throw new Error('Cannot issue JWT, no key set');
    }
    return jwt.sign(data, this.signingKeyBytes, {
      subject,
      audience: this.audience,
      issuer: this.issuer,
      algorithm: 'HS256',
      expiresIn: this.expiresIn,
      jwtid: randomUUID(),
      keyid: this.signingKeyId,
    });
  }

  async verifyToken(authToken: string) {
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
      return decodedToken;
    }
    console.warn(`Missing subject in token ${JSON.stringify(decodedToken)}`);
    throw new UnauthorizedError('Invalid Token');
  }

  async validateToken(
    authToken: string
  ): Promise<{ subject: string; data: D; expiresAt: number }> {
    try {
      const decodedToken = await this.verifyToken(authToken);

      const { sub, exp, ...rest } = decodedToken;
      return {
        subject: sub as string,
        expiresAt: exp as number,
        data: rest as D,
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        const decodedToken = jwt.decode(authToken, {
          json: true,
        });
        const unauthError = new UnauthorizedError('Expired token');
        unauthError.handle = decodedToken?.handle;
        throw unauthError;
      }
      throw error;
    }
  }
}
