import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from '../common/enums/role.enum';

/**
 * Promote named accounts to admin on boot.
 *
 * WHY THIS EXISTS
 *
 * There is no admin sign-up endpoint, and there should not be — anything
 * reachable over HTTP that grants the admin role is a target. That left
 * "connect to the production database and run an UPDATE" as the only way to
 * create the first admin, which is a bad first-run experience on every new
 * environment and is impossible on hosts with no console access.
 *
 * WHY THIS IS NOT A BACK DOOR
 *
 * It only ever ELEVATES AN ACCOUNT THAT ALREADY EXISTS. It never creates a
 * user and never sets a password, so the listed email is useless to anyone who
 * cannot already sign in as it. Setting `ADMIN_EMAILS` requires deploy access,
 * and anyone with deploy access can already reach the database — so this grants
 * nothing that was not already available, it just removes the psql step.
 *
 * The promotion is logged every time, and the variable is safe to leave set:
 * re-running it on an account that is already an admin is a no-op.
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const emails = parseAdminEmails(this.config.get<string>('ADMIN_EMAILS'));
    if (emails.length === 0) return;

    try {
      await this.promote(emails);
    } catch (error) {
      // Never fatal. A failure here means one operator cannot reach /admin —
      // it is not a reason to take the whole API down.
      this.logger.error(
        `Admin bootstrap failed: ${(error as Error).message}. ` +
          `Promote manually with: UPDATE users SET role='admin' WHERE email='...';`,
      );
    }
  }

  private async promote(emails: string[]): Promise<void> {
    const found = await this.users.find({
      where: { email: In(emails) },
      select: ['id', 'email', 'role'],
    });

    const missing = emails.filter(
      (e) => !found.some((u) => u.email.toLowerCase() === e),
    );

    if (missing.length > 0) {
      // The common case on a fresh deploy: the variable is set before anyone
      // has signed up. Said plainly so it does not look like a failure.
      this.logger.warn(
        `ADMIN_EMAILS lists ${missing.join(', ')}, but no such account exists ` +
          `yet. Register normally, then redeploy or restart to be promoted.`,
      );
    }

    const toPromote = found.filter((u) => u.role !== Role.ADMIN);

    if (toPromote.length === 0) {
      if (found.length > 0) {
        this.logger.log(
          `Admin bootstrap: ${found.length} account(s) already admin.`,
        );
      }
      return;
    }

    await this.users.update(
      { id: In(toPromote.map((u) => u.id)) },
      { role: Role.ADMIN },
    );

    this.logger.warn(
      `Admin bootstrap: promoted ${toPromote
        .map((u) => u.email)
        .join(', ')} to admin.`,
    );
  }
}

/**
 * Split and normalise the variable.
 *
 * Lower-cased because email comparison is case-insensitive in practice and a
 * capitalised entry silently failing to match is a miserable thing to debug.
 */
export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'));
}
