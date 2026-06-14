import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/**
 * Validator kiá»ƒm tra chuá»—i khÃ´ng chá»©a emoji, kÃ½ tá»± Ä‘iá»u khiá»ƒn,
 * hoáº·c ná»™i dung script/html khÃ´ng an toÃ n.
 */
@ValidatorConstraint({ name: 'noEmojiOrControl', async: false })
@Injectable()
export class NoEmojiOrControlConstraint implements ValidatorConstraintInterface {
  // Pattern phÃ¡t hiá»‡n emoji (Unicode Extended_Pictographic)
  private readonly emojiPattern =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/u;
  // Pattern phÃ¡t hiá»‡n kÃ½ tá»± Ä‘iá»u khiá»ƒn (trá»« newline, tab, carriage return)
  private readonly controlPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
  // Pattern phÃ¡t hiá»‡n tháº» HTML/script cÆ¡ báº£n
  private readonly htmlPattern = /<[^>]*>/;

  validate(value: string, _args: ValidationArguments): boolean {
    if (!value || typeof value !== 'string') return true;
    return !(
      this.emojiPattern.test(value) ||
      this.controlPattern.test(value) ||
      this.htmlPattern.test(value)
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'Chuỗi chứa ký tự không hợp lệ (emoji, ký tự điều khiển, hoặc thẻ HTML)';
  }
}
