"use client";

import type { ComponentProps, ReactNode } from "react";
import type { DashboardData } from "@agentic/repository";
import { CommandPalette } from "./command-palette";
import { CoreLoopViewTracker } from "./core-loop-view-tracker";
import { DashboardDetailDrawer, type DashboardDetailSelection } from "./dashboard-cockpit";
import {
  ApprovalNavigationProvider,
  FaviconBadge,
  FloatingActionsBar,
  FocusMode,
  KeyboardShortcutsProvider,
  NLFloatingBar,
  QuickActionsBar,
  RelativeTime,
  RiskBadge,
  RiskClassHelp,
  StatsBar,
  ThemeToggle,
  ToastContainer
} from "./ui";

type DashboardShellProps = {
  pendingApprovals: DashboardData["approvals"];
  onApprove: (approvalId: string) => void | Promise<void>;
  onReject: (approvalId: string) => void | Promise<void>;
  isPending: boolean;
  focusMode: {
    isInFocusMode: boolean;
    focusedSection: { id: string; title: string } | null;
    exitFocus: () => void;
  };
  nlExecute: ComponentProps<typeof NLFloatingBar>["onExecute"];
  nlCapabilitySummary: ComponentProps<typeof NLFloatingBar>["capabilitySummary"];
  activeWorkspaceId: string | null;
  themeMode: string;
  statsBarProps: ComponentProps<typeof StatsBar>;
  quickActions: ComponentProps<typeof QuickActionsBar>["actions"];
  detailSelection: DashboardDetailSelection | null;
  closeDetail: () => void;
  openView: ComponentProps<typeof DashboardDetailDrawer>["openView"];
  onCreateGoal: ComponentProps<typeof CommandPalette>["onCreateGoal"];
  onFocusRequestComposer: () => void;
  onNavigateToSection: (sectionId: string) => void;
  onLogout: () => void;
  children: ReactNode;
};

export function DashboardShell({
  pendingApprovals,
  onApprove,
  onReject,
  isPending,
  focusMode,
  nlExecute,
  nlCapabilitySummary,
  activeWorkspaceId,
  themeMode,
  statsBarProps,
  quickActions,
  detailSelection,
  closeDetail,
  openView,
  onCreateGoal,
  onFocusRequestComposer,
  onNavigateToSection,
  onLogout,
  children
}: DashboardShellProps) {
  return (
    <ApprovalNavigationProvider approvals={pendingApprovals} onApprove={onApprove} onReject={onReject}>
      <KeyboardShortcutsProvider>
        <FaviconBadge count={pendingApprovals.length} />
        <ToastContainer />

        <FocusMode
          isActive={focusMode.isInFocusMode}
          sectionId={focusMode.focusedSection?.id || ""}
          title={focusMode.focusedSection?.title || ""}
          onClose={focusMode.exitFocus}
        >
          {focusMode.focusedSection?.id === "approvals" ? (
            <div className="focus-approvals">
              {pendingApprovals.map((approval) => (
                <div className="list-item vertical" key={approval.id}>
                  <div>
                    <strong>{approval.title}</strong>
                    <p>{approval.rationale}</p>
                  </div>
                  <div className="approval-actions">
                    <RiskClassHelp riskClass={approval.riskClass}>
                      <RiskBadge riskClass={approval.riskClass} />
                    </RiskClassHelp>
                    <RelativeTime date={approval.createdAt} />
                    <button type="button" onClick={() => onApprove(approval.id)} disabled={isPending}>
                      Approve
                    </button>
                    <button type="button" className="secondary-button" onClick={() => onReject(approval.id)} disabled={isPending}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </FocusMode>

        <NLFloatingBar onExecute={nlExecute} capabilitySummary={nlCapabilitySummary} />

        <main className={`dashboard-shell ${themeMode === "dark" ? "dark-mode" : ""}`}>
          <CoreLoopViewTracker workspaceId={activeWorkspaceId} />
          <div className="stats-bar-wrapper">
            <StatsBar {...statsBarProps} />
            <ThemeToggle />
          </div>

          {children}

          <FloatingActionsBar position="bottom">
            <QuickActionsBar actions={quickActions} />
          </FloatingActionsBar>

          <DashboardDetailDrawer detail={detailSelection} onClose={closeDetail} openView={openView} />

          <CommandPalette
            onCreateGoal={onCreateGoal}
            onFocusRequestComposer={onFocusRequestComposer}
            onNavigateToSection={onNavigateToSection}
            onLogout={onLogout}
            isPending={isPending}
          />
        </main>
      </KeyboardShortcutsProvider>
    </ApprovalNavigationProvider>
  );
}
