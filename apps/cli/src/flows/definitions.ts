import type { FlowDefinition } from "@khoralabs/cli-kit/flow";

export const connectFlowDefinition: FlowDefinition = {
  id: "vellum-connect",
  fields: [{ id: "channelId", prompt: "Channel ID: " }],
};

export const channelJoinFlowDefinition: FlowDefinition = {
  id: "vellum-channel-join",
  fields: [{ id: "inviteToken", prompt: "Invite token: " }],
};

export const channelAttachFlowDefinition: FlowDefinition = {
  id: "vellum-channel-attach",
  fields: [
    {
      id: "inviteToken",
      prompt: "Invite token (leave empty if already a member): ",
      optional: true,
    },
  ],
};
