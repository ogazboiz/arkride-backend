import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  Min,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for requesting daily fuel support from the microfinance bank
 */
export class RequestFuelSupportDto {
  @ApiProperty({ example: 2000, description: 'Amount in Naira' })
  @IsNotEmpty({ message: 'Amount is required' })
  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(100, { message: 'Minimum fuel support request is ₦100' })
  amount: number;
}

export class BankAccountDto {
  @ApiProperty({ example: '0123456789' })
  @IsNotEmpty({ message: 'Account number is required' })
  @Matches(/^\d{10}$/, { message: 'Account number must be 10 digits' })
  accountNumber: string;

  @ApiProperty({ example: '058', description: 'Nigerian bank code' })
  @IsNotEmpty({ message: 'Bank code is required' })
  @IsString()
  bankCode: string;

  @ApiPropertyOptional({ example: 'Adebayo Okonkwo' })
  @IsOptional()
  @IsString()
  accountName?: string;
}

/**
 * DTO for withdrawing earnings through LinkPay
 */
export class RequestPayoutDto {
  @ApiProperty({ example: 15000, description: 'Amount in Naira' })
  @IsNotEmpty({ message: 'Amount is required' })
  @IsNumber({}, { message: 'Amount must be a number' })
  @Min(500, { message: 'Minimum payout is ₦500' })
  amount: number;

  @ApiProperty({ type: () => BankAccountDto })
  @IsNotEmpty({ message: 'Bank account is required' })
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount: BankAccountDto;
}
