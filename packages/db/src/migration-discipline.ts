import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DatabaseMigrationFile, listMigrationFiles } from "./migration-runtime";

const DEFAULT_MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const DEFAULT_ROLLBACK_NOTES_PATH = path.join(DEFAULT_MIGRATIONS_DIR, "ROLLBACK.md");
const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u;
const LEGACY_DUPLICATE_PREFIXES = new Set(["0004", "0005"]);

export type MigrationDisciplineIssue = {
  code: "invalid_name" | "out_of_order" | "duplicate_prefix" | "missing_rollback_note" | "destructive_sql";
  severity: "fail" | "warn";
  migration: string;
  message: string;
};

export type MigrationDisciplineReport = {
  status: "pass" | "warn" | "fail";
  checkedMigrations: string[];
  rollbackNotesPath: string;
  issues: MigrationDisciplineIssue[];
};

function migrationPrefix(name: string): string {
  return name.split("_", 1)[0] ?? "";
}

function classifyStatus(issues: MigrationDisciplineIssue[]): MigrationDisciplineReport["status"] {
  if (issues.some((issue) => issue.severity === "fail")) {
    return "fail";
  }

  return issues.length > 0 ? "warn" : "pass";
}

export function analyzeMigrationDiscipline(params: {
  migrations: Pick<DatabaseMigrationFile, "name" | "sql">[];
  rollbackNotes: string;
  rollbackNotesPath?: string;
}): MigrationDisciplineReport {
  const issues: MigrationDisciplineIssue[] = [];
  const names = params.migrations.map((migration) => migration.name);
  const sortedNames = [...names].sort((left, right) => left.localeCompare(right));

  for (const migration of params.migrations) {
    if (!MIGRATION_NAME_PATTERN.test(migration.name)) {
      issues.push({
        code: "invalid_name",
        severity: "fail",
        migration: migration.name,
        message: "Migration filename must use a zero-padded numeric prefix and snake_case label."
      });
    }

    if (!params.rollbackNotes.includes(migration.name)) {
      issues.push({
        code: "missing_rollback_note",
        severity: "fail",
        migration: migration.name,
        message: "Migration is missing an explicit rollback note."
      });
    }

    if (/\b(drop\s+table|drop\s+column|delete\s+from|truncate\s+table)\b/iu.test(migration.sql)) {
      issues.push({
        code: "destructive_sql",
        severity: "warn",
        migration: migration.name,
        message: "Migration contains destructive SQL and must document rollout and rollback implications."
      });
    }
  }

  names.forEach((name, index) => {
    if (name !== sortedNames[index]) {
      issues.push({
        code: "out_of_order",
        severity: "fail",
        migration: name,
        message: "Migration files must be applied in lexicographic order."
      });
    }
  });

  const prefixToNames = new Map<string, string[]>();
  for (const name of names) {
    const prefix = migrationPrefix(name);
    prefixToNames.set(prefix, [...(prefixToNames.get(prefix) ?? []), name]);
  }

  for (const [prefix, duplicateNames] of prefixToNames) {
    if (duplicateNames.length <= 1) {
      continue;
    }

    const legacyDuplicate = LEGACY_DUPLICATE_PREFIXES.has(prefix);
    for (const name of duplicateNames) {
      issues.push({
        code: "duplicate_prefix",
        severity: legacyDuplicate ? "warn" : "fail",
        migration: name,
        message: legacyDuplicate
          ? "Legacy duplicate migration prefix is tolerated but new migrations must use a unique prefix."
          : "Migration prefix must be unique."
      });
    }
  }

  return {
    status: classifyStatus(issues),
    checkedMigrations: names,
    rollbackNotesPath: params.rollbackNotesPath ?? DEFAULT_ROLLBACK_NOTES_PATH,
    issues
  };
}

export async function checkMigrationDiscipline(options?: {
  migrationsDir?: string;
  rollbackNotesPath?: string;
}): Promise<MigrationDisciplineReport> {
  const migrationsDir = options?.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const rollbackNotesPath = options?.rollbackNotesPath ?? path.join(migrationsDir, "ROLLBACK.md");
  const [migrations, rollbackNotes] = await Promise.all([
    listMigrationFiles({ migrationsDir }),
    readFile(rollbackNotesPath, "utf8")
  ]);

  return analyzeMigrationDiscipline({
    migrations,
    rollbackNotes,
    rollbackNotesPath
  });
}
