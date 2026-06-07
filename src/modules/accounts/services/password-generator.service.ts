import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class PasswordGeneratorService {
  private readonly UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private readonly LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
  private readonly DIGITS = '0123456789';
  private readonly SPECIAL_CHARS = '@#$%^&*!_-+=';

  generateTemporaryPassword(length = 12): string {
    if (length < 4) {
      throw new Error('Password length must be at least 4');
    }

    // Ensure at least one character from each set
    const passwordChars: string[] = [
      this.getRandomChar(this.UPPERCASE),
      this.getRandomChar(this.LOWERCASE),
      this.getRandomChar(this.DIGITS),
      this.getRandomChar(this.SPECIAL_CHARS),
    ];

    // Combine all sets for the remaining characters
    const allChars =
      this.UPPERCASE + this.LOWERCASE + this.DIGITS + this.SPECIAL_CHARS;

    for (let i = 4; i < length; i++) {
      passwordChars.push(this.getRandomChar(allChars));
    }

    // Shuffle using Fisher-Yates algorithm with CSPRNG
    return this.shuffle(passwordChars).join('');
  }

  private getRandomChar(charSet: string): string {
    const randomIndex = crypto.randomInt(0, charSet.length);
    return charSet.charAt(randomIndex);
  }

  private shuffle(array: string[]): string[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
