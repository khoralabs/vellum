/** Shared help text: where CLI commands resolve channel id. */
export const CHANNEL_ID_RESOLUTION_HELP = `Channel id resolution (when required):
  1. positional argument (<channelId> on connect/attach/disconnect)
  2. --channel=<id>

Multiple channels run in parallel — one daemon per channel under vellum/channels/<id>/.
Pass an explicit channel id on every command that targets a channel.`;
