import { IsBoolean, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';


export class UpdateDriverOnlineStatusDto {
  @Type(() => Boolean)
  @IsNotEmpty()
  @IsBoolean()
  isOnline?: boolean;
}
