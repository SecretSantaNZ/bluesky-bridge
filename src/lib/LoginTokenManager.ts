import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UnauthorizedError } from 'http-errors-enhanced';

export class LoginTokenManager {
  private keyId: string | undefined;
  private keyBytes: Buffer | undefined;

  constructor(
    private issuer: string,
    private audience: string
  ) {}

  setKey(keyId: string, keyBytes: Buffer) {
    this.keyId = keyId;
    this.keyBytes = keyBytes;
  }

  async generateToken(postKey: string): Promise<string> {
    if (this.keyBytes == null) {
      throw new Error('Cannot issue JWT, no key set');
    }
    return jwt.sign({}, this.keyBytes, {
      subject: postKey,
      audience: this.audience,
      issuer: this.issuer,
      algorithm: 'HS256',
      expiresIn: '5 minutes',
      jwtid: uuidv4(),
      keyid: this.keyId,
    });
  }

  async validateToken(
    loginToken: string
  ): Promise<{ postKey: string; expiresAt: number }> {
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
        postKey: sub as string,
        expiresAt: exp as number,
      };
    }
    console.warn(`Missing subject in token ${JSON.stringify(decodedToken)}`);
    throw new UnauthorizedError('Invalid Token');
  }
}
