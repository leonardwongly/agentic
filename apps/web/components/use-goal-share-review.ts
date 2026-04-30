"use client";

import { startTransition, useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardData } from "@agentic/repository";
import type { GoalShareDisclosureReview } from "../lib/share-disclosure";
import { getGoalShareSuccessMessage } from "../lib/share-client";
import { readJson } from "./dashboard-async";
import type { RequestState } from "./dashboard-types";

type PendingGoalShareReview = {
  goalId: string;
  goalTitle: string;
  review: GoalShareDisclosureReview;
  reviewFingerprint: string;
};

type UseGoalShareReviewOptions = {
  setData: Dispatch<SetStateAction<DashboardData>>;
  setIsPending: Dispatch<SetStateAction<boolean>>;
  setShareState: Dispatch<SetStateAction<RequestState>>;
};

export function useGoalShareReview({ setData, setIsPending, setShareState }: UseGoalShareReviewOptions) {
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);
  const [pendingShareReview, setPendingShareReview] = useState<PendingGoalShareReview | null>(null);

  const shareGoal = useCallback(async (goalId: string, title: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{
        reviewRequired: true;
        disclosureReview: GoalShareDisclosureReview;
        reviewFingerprint: string;
        dashboard: DashboardData;
      }>(
        await fetch(`/api/goals/${encodeURIComponent(goalId)}/share`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            preview: true
          })
        })
      );

      startTransition(() => {
        setData(payload.dashboard);
        setLastShareUrl(null);
        setPendingShareReview({
          goalId,
          goalTitle: title,
          review: payload.disclosureReview,
          reviewFingerprint: payload.reviewFingerprint
        });
        setShareState({
          kind: "success",
          message: `Review the public share projection for "${title}" before creating a link.`
        });
      });
    } catch (error) {
      setShareState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create the public share link."
      });
    } finally {
      setIsPending(false);
    }
  }, [setData, setIsPending, setShareState]);

  const cancelGoalShareReview = useCallback(() => {
    setPendingShareReview(null);
    setShareState({
      kind: "idle",
      message: ""
    });
  }, [setShareState]);

  const confirmGoalShare = useCallback(async () => {
    if (!pendingShareReview) {
      return;
    }

    setIsPending(true);

    try {
      const payload = await readJson<{
        shareId: string;
        shareUrl: string;
        disclosureReview: GoalShareDisclosureReview;
        dashboard: DashboardData;
      }>(
        await fetch(`/api/goals/${encodeURIComponent(pendingShareReview.goalId)}/share`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            confirmed: true,
            reviewFingerprint: pendingShareReview.reviewFingerprint,
            expiryDays: pendingShareReview.review.expiryDays
          })
        })
      );
      const canCopy = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
      let copiedToClipboard = false;

      if (canCopy) {
        try {
          await navigator.clipboard.writeText(payload.shareUrl);
          copiedToClipboard = true;
        } catch {
          copiedToClipboard = false;
        }
      }

      startTransition(() => {
        setData(payload.dashboard);
        setLastShareUrl(payload.shareUrl);
        setPendingShareReview(null);
        setShareState({
          kind: "success",
          message: getGoalShareSuccessMessage(pendingShareReview.goalTitle, copiedToClipboard)
        });
      });
    } catch (error) {
      setShareState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create the public share link."
      });
    } finally {
      setIsPending(false);
    }
  }, [pendingShareReview, setData, setIsPending, setShareState]);

  return {
    lastShareUrl,
    pendingShareReview,
    shareGoal,
    confirmGoalShare,
    cancelGoalShareReview
  };
}
