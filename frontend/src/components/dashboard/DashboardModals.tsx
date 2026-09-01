"use client";

import React from "react";
import { AddProductModal } from "@/components/dashboard/product/modals/AddProductModal";
import { EditProductModal } from "@/components/dashboard/product/modals/EditProductModal";
import { ImportCsvModal } from "@/components/dashboard/product/modals/ImportCsvModal";
import { ScriptBankPreviewModal } from "@/components/dashboard/product/modals/ScriptBankPreviewModal";
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
      <ScriptBankPreviewModal />
      <EndLiveConfirmModal />
      <SessionSummaryModal />
      <SettingsModal />
      <TutorialModal />
      <ConnectingOverlay />
    </>
  );
};