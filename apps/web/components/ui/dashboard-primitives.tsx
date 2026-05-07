"use client";

import type { HTMLAttributes, ReactNode } from "react";

type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

type MetricCardProps = {
  label: string;
  value: string | number;
  detail?: string;
  status?: "healthy" | "attention" | "critical" | "idle";
};

type PillProps = {
  label: string;
  tone?: "healthy" | "attention" | "critical" | "idle" | "neutral";
};

type ActionGroupProps = {
  label: string;
  children: ReactNode;
};

export type DataTableColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
};

type DataTableProps<T> = {
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyLabel?: string;
};

export function Panel({ title, subtitle, actions, children, className = "", ...props }: PanelProps) {
  return (
    <article className={`ui-panel ${className}`.trim()} {...props}>
      {title || subtitle || actions ? (
        <div className="ui-panel-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="ui-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </article>
  );
}

export function SectionHeader({ eyebrow, title, subtitle, actions }: SectionHeaderProps) {
  return (
    <div className="ui-section-header">
      <div>
        {eyebrow ? <p className="ui-eyebrow">{eyebrow}</p> : null}
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="ui-section-actions">{actions}</div> : null}
    </div>
  );
}

export function MetricCard({ label, value, detail, status = "idle" }: MetricCardProps) {
  return (
    <div className={`ui-metric-card ${status}`} aria-label={`${label}: ${value}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function StatusPill({ label, tone = "neutral" }: PillProps) {
  return (
    <span className={`ui-pill status ${tone}`} data-ui-status-pill="true">
      {label}
    </span>
  );
}

export function RiskPill({ label, tone = "neutral" }: PillProps) {
  return (
    <span className={`ui-pill risk ${tone}`} data-ui-risk-pill="true">
      {label}
    </span>
  );
}

export function ActionGroup({ label, children }: ActionGroupProps) {
  return (
    <div className="ui-action-group" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

export function DataTable<T>({ caption, columns, rows, getRowKey, emptyLabel = "No rows available." }: DataTableProps<T>) {
  return (
    <div className="ui-data-table-wrap">
      <table className="ui-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th scope="col" key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyLabel}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td data-label={column.header} key={`${getRowKey(row)}-${column.key}`}>{column.render(row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
