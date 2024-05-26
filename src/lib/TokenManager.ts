import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UnauthorizedError } from 'http-errors-enhanced';
import ms from 'ms';

export class TokenManager {
  private keyId: string | undefined;
  private keyBytes: Buffer | undefined;
  readonly expiresInSeconds: number;

  constructor(
    private issuer: string,
    private audience: string,
    private expiresIn: string
  ) {
    this.expiresInSeconds = ms(expiresIn) / 1000;
  }

  setKey(keyId: string, keyBytes: Buffer) {
    this.keyId = keyId;
    this.keyBytes = keyBytes;
  }

  async generateToken(subject: string): Promise<string> {
    if (this.keyBytes == null) {
      throw new Error('Cannot issue JWT, no key set');
    }
    return jwt.sign({}, this.keyBytes, {
      subject,
      audience: this.audience,
      issuer: this.issuer,
      algorithm: 'HS256',
      expiresIn: this.expiresIn,
      jwtid: uuidv4(),
      keyid: this.keyId,
    });
  }

  async validateToken(
    loginToken: string
  ): Promise<{ subject: string; expiresAt: number }> {
    if (this.keyBytes == null) {
      throw new Error('Cannot validate JWT, no key set');
    }
    const decodedToken = jwt.verify(loginToken, this.keyBytes, {
      issuer: this.issuer,
      audience: this.audience,
    });

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
