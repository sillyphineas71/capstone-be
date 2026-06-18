import {
  IsBoolean,
  IsOptional,
  IsIn,
  IsUrl,
  IsIP,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';

export class ConfigureFaceServerDto {
  @IsBoolean()
  @IsOptional()
  callback_enabled?: boolean;

  @IsIn(['http', 'https'])
  callback_protocol: 'http' | 'https';

  @IsUrl({ require_tld: false })
  @IsOptional()
  callback_base_url?: string;

  @IsIP()
  @IsNotEmpty()
  allowed_source_ip: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9-_\/]+$/, {
    message: 'heartbeat_path must be a valid path starting with /',
  })
  heartbeat_path: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9-_\/]+$/, {
    message: 'verify_path must be a valid path starting with /',
  })
  verify_path: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\/[a-zA-Z0-9-_\/]+$/, {
    message: 'stranger_path must be a valid path starting with /',
  })
  stranger_path: string;
}
