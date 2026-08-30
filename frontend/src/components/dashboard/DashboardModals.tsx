"use client";

import React from "react";
import { AddProductModal } from "@/components/dashboard/product/modals/AddProductModal";
import { EditProductModal } from "@/components/dashboard/product/modals/EditProductModal";
import { ImportCsvModal } from "@/components/dashboard/product/modals/ImportCsvModal";
import { LiveScriptModal } from "@/components/dashboard/product/modals/LiveScriptModal";
import { EndLiveConfirmModal } from "@/components/dashboard/live-studio/modals/EndLiveConfirmModal";
import { SessionSummaryModal } from "@/components/dashboard/live-studio/modals/SessionSummaryModal";
import { SettingsModal } from "@/components/dashboard/live-studio/modals/SettingsModal";
import { TutorialModal } from "@/components/dashboard/live-studio/modals/TutorialModal";
import { ConnectingOverlay } from "@/components/dashboard/live-studio/modals/ConnectingOverlay";

export const DashboardModals: React.FC = () => {
  return (
    <>
      <AddProductModal />
      <EditProductModal />
      <ImportCsvModal />
      <LiveScriptModal />
      <EndLiveConfirmModal />
      <SessionSummaryModal />
      <SettingsModal />
      <TutorialModal />
      <ConnectingOverlay />
    </>
  );
};