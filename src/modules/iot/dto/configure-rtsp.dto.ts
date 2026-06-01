import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class ConfigureRtspDto {
  @IsOptional()
  @IsBoolean()
  rtsp_enabled?: boolean;

  @IsNotEmpty()
  @IsEnum(['rtsp', 'rtsps'])
  rtsp_protocol: string;

  @IsNotEmpty()
  @IsString()
  @Matches(
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)+([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$|^([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])$/,
    {
      message:
        'rtsp_host must be a valid IP address or hostname without protocol, port, or path',
    },
  )
  rtsp_host: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(65535)
  rtsp_port?: number;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\//, {
    message:
      'rtsp_path must start with a forward slash (/) and contain no host/domain',
  })
  rtsp_path: string;

  @IsOptional()
  @IsString()
  rtsp_username?: string;

  @IsOptional()
  @IsString()
  rtsp_password?: string;

  @IsOptional()
  @IsString()
  stream_profile?: string;
}
