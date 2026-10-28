import { Migration } from '@mikro-orm/migrations';

export class Migration20261028211913_schema extends Migration {
  override name = 'Migration20261028211913_schema';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "users" ("id" uuid not null, "email" varchar(254) not null, "password_hash" text not null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`alter table "users" add constraint "users_email_unique" unique ("email");`);

    this.addSql(
      `create table "sessions" ("id" uuid not null, "user_id" uuid not null, "token_hash" varchar(64) not null, "created_at" timestamptz not null, "expires_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`create index "sessions_user_id_index" on "sessions" ("user_id");`);
    this.addSql(
      `alter table "sessions" add constraint "sessions_token_hash_unique" unique ("token_hash");`,
    );

    this.addSql(
      `create table "generation_usage" ("id" uuid not null, "user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "generation_usage_user_id_created_at_index" on "generation_usage" ("user_id", "created_at");`,
    );
    this.addSql(
      `create index "generation_usage_created_at_index" on "generation_usage" ("created_at");`,
    );

    this.addSql(
      `create table "cvs" ("id" uuid not null, "user_id" uuid not null, "target_role" varchar(200) not null, "document" jsonb null, "version" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`create index "cvs_user_id_updated_at_index" on "cvs" ("user_id", "updated_at");`);

    this.addSql(
      `create table "generation_jobs" ("id" uuid not null, "cv_id" uuid not null, "user_id" uuid not null, "kind" text not null, "status" text not null default 'queued', "step" text null, "attempts" int not null default 0, "max_attempts" int not null default 3, "run_after" timestamptz not null, "locked_by" varchar(64) null, "locked_until" timestamptz null, "llm_calls" int not null default 0, "state" jsonb not null default '{}', "payload" jsonb not null default '{}', "target" jsonb null, "error_code" text null, "error_message" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "generation_jobs_status_run_after_index" on "generation_jobs" ("status", "run_after");`,
    );
    this.addSql(
      `create index "generation_jobs_cv_id_created_at_index" on "generation_jobs" ("cv_id", "created_at");`,
    );
    this.addSql(
      `create unique index "generation_jobs_one_active_per_cv" on "generation_jobs" ("cv_id") where status in ('queued', 'running');`,
    );
    this.addSql(
      `alter table "generation_jobs" add constraint "generation_jobs_kind_check" check ("kind" in ('generate', 'apply_answer'));`,
    );
    this.addSql(
      `alter table "generation_jobs" add constraint "generation_jobs_status_check" check ("status" in ('queued', 'running', 'succeeded', 'failed'));`,
    );
    this.addSql(
      `alter table "generation_jobs" add constraint "generation_jobs_step_check" check ("step" in ('extract', 'write', 'judge', 'finalize'));`,
    );
    this.addSql(
      `alter table "generation_jobs" add constraint "generation_jobs_error_code_check" check ("error_code" in ('AI_UNAVAILABLE', 'AI_LIMIT_REACHED', 'AI_REFUSED', 'AI_KEY_REJECTED', 'INTERNAL'));`,
    );

    this.addSql(
      `create table "cv_sources" ("cv_id" uuid not null, "kind" text not null, "text" text not null, "facts" jsonb null, "created_at" timestamptz not null, primary key ("cv_id"));`,
    );
    this.addSql(
      `alter table "cv_sources" add constraint "cv_sources_kind_check" check ("kind" in ('pdf', 'text'));`,
    );

    this.addSql(
      `create table "cv_questions" ("id" uuid not null, "cv_id" uuid not null, "kind" text not null, "target" jsonb not null, "prompt" text not null, "context" text null, "answer_type" text not null, "status" text not null default 'open', "answer" jsonb null, "apply_status" text null, "apply_note" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(`create index "cv_questions_cv_id_index" on "cv_questions" ("cv_id");`);
    this.addSql(
      `alter table "cv_questions" add constraint "cv_questions_kind_check" check ("kind" in ('missing', 'vague', 'unverified'));`,
    );
    this.addSql(
      `alter table "cv_questions" add constraint "cv_questions_answer_type_check" check ("answer_type" in ('dates', 'text'));`,
    );
    this.addSql(
      `alter table "cv_questions" add constraint "cv_questions_status_check" check ("status" in ('open', 'answered', 'dismissed'));`,
    );
    this.addSql(
      `alter table "cv_questions" add constraint "cv_questions_apply_status_check" check ("apply_status" in ('applying', 'applied', 'partial', 'failed'));`,
    );

    this.addSql(
      `alter table "sessions" add constraint "sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`,
    );

    this.addSql(
      `alter table "generation_usage" add constraint "generation_usage_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`,
    );

    this.addSql(
      `alter table "cvs" add constraint "cvs_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`,
    );

    this.addSql(
      `alter table "generation_jobs" add constraint "generation_jobs_cv_id_foreign" foreign key ("cv_id") references "cvs" ("id") on delete cascade;`,
    );
    this.addSql(
      `alter table "generation_jobs" add constraint "generation_jobs_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete cascade;`,
    );

    this.addSql(
      `alter table "cv_sources" add constraint "cv_sources_cv_id_foreign" foreign key ("cv_id") references "cvs" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "cv_questions" add constraint "cv_questions_cv_id_foreign" foreign key ("cv_id") references "cvs" ("id") on delete cascade;`,
    );
  }
}
