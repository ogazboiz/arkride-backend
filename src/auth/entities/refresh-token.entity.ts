import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';

/**
 * A refresh token, stored as a HASH.
 *
 * WHY THIS TABLE EXISTS
 *
 * Access tokens used to last SEVEN DAYS with no `jti`, no denylist and no
 * logout endpoint, so there was no mechanism by which a session could ever be
 * ended: a stolen token, or a dismissed driver's token, stayed valid for a
 * week. Shortening the access token to an hour is only an improvement if there
 * is something to renew it with — that is this.
 *
 * WHAT IS STORED
 *
 * `tokenHash`, never the token. A read of this table gives an attacker
 * nothing usable, because the value the client presents is only ever compared
 * by hash. (SHA-256 is right here and bcrypt is not: the token is 256 bits of
 * CSPRNG output, so there is no low-entropy secret to slow a guesser down —
 * and this runs on every refresh.)
 *
 * ROTATION AND REUSE DETECTION
 *
 * Every refresh consumes its token and issues a new one, linked by `familyId`.
 * A token is therefore valid exactly once. If an ALREADY-CONSUMED token is
 * presented, that means two parties hold the same one — the legitimate client
 * and a thief — and there is no way to tell which is which. So the whole
 * family is revoked and both are forced to sign in again. Losing a session is
 * the correct answer to "someone else may have your session".
 */
@Entity('refresh_tokens')
@Index('idx_refresh_family', ['familyId'])
@Index('idx_refresh_subject', ['subjectId', 'subjectType'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * SHA-256 of the token, hex encoded. Unique so a hash collision or a
   * duplicate insert is a database error rather than two live sessions.
   */
  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash: string;

  /**
   * All tokens descended from one sign-in share this. Revoking a family ends
   * that whole login, however many times it has been rotated.
   */
  @Column({ type: 'uuid' })
  familyId: string;

  /** The user or driver row this session belongs to. */
  @Column({ type: 'uuid' })
  subjectId: string;

  /**
   * Which table `subjectId` points at.
   *
   * Riders and drivers are separate tables with separate id spaces, so an id
   * alone is ambiguous — without this, a driver id could resolve to a user row
   * that happened to share it.
   */
  @Column({ type: 'enum', enum: Role })
  subjectType: Role;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  /** Set when consumed by a rotation, or when revoked by logout/reuse. */
  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  /** Why it was revoked — 'rotated' | 'logout' | 'reuse-detected'. */
  @Column({ type: 'varchar', nullable: true })
  revokedReason: string | null;

  /**
   * Coarse client fingerprint, for the audit trail only.
   *
   * Deliberately NOT part of the validity check: mobile clients change IP
   * constantly, and binding a session to an IP would sign riders out every
   * time they moved between cell towers and wifi.
   */
  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', nullable: true })
  ipAddress: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
