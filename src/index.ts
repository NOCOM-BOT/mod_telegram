import CMComm from "./CMC.js";
import Logger from "./Logger.js";

import { Telegraf } from 'telegraf';

let cmc = new CMComm();
let logger = new Logger(cmc);

interface IMessageData {
    interfaceID: number;
    content: string;
    attachments: {
        filename: string,
        url: string
    }[],
    channelID: string;
    replyMessageID?: string,
    additionalInterfaceData?: any
}

let dataPathRequest = await cmc.callAPI("core", "get_data_folder", null);
let dataPath = "";
if (dataPathRequest.exist) {
    dataPath = dataPathRequest.data;
} else {
    process.exit(1);
}

cmc.on("api:login", async (call_from: string, data: {
    interfaceID: number;
    loginData: {
        botToken: string;
    }
}, callback: (error?: any, data?: any) => void) => {
    let bot = new Telegraf(data.loginData.botToken);

    // Logging in
    try {
        await bot.launch()
    } catch {
        callback("Invalid bot token", {
            success: false
        });
        return;
    }

    // Logged in, now we can start listening to messages
    // Note that we don't use Telegram command (yet), so we'll listen for actual messages
    // and send it to command handler.
    bot.on("text", async (ctx) => {
        // Simple text.
        cmc.callAPI("core", "send_event", {
            eventName: "interface_message",
            data: {
                interfaceID: data.interfaceID,
                interfaceHandlerName: "Telegram",

                content: ctx.message.text,
                attachments: [],
                mentions: Object.fromEntries(
                    (await Promise.all(
                        ctx.message.entities
                            ?.map?.(async e => {
                                switch (e.type) {
                                    case "mention":
                                        // Resolve username to ID
                                        let username = ctx.message.text.substring(e.offset + 1, e.offset + e.length);
                                        let usernameChat = await ctx.telegram.getChat(username);
                                        return [usernameChat.id, {
                                            start: e.offset,
                                            length: e.length
                                        }];
                                    case "text_mention":
                                        return [e.user.id, {
                                            start: e.offset,
                                            length: e.length
                                        }];
                                    default:
                                        return [];
                                }
                            }) ?? []
                    )).filter(x => x.length)
                ),

                messageID: ctx.message.message_id.toString(),
                formattedMessageID: `${ctx.botInfo.id}_${ctx.message.message_id}@Message@Telegram`,
                channelID: ctx.chat.id.toString(),
                formattedChannelID: `${ctx.chat.id}@Channel@Telegram`,
                // Telegram doesn't have guilds, so we'll just use channel ID as guild ID.
                guildID: ctx.chat.id.toString(),
                formattedGuildID: `${ctx.chat.id}@Channel@Telegram`,
                senderID: ctx.from.id.toString(),
                formattedSenderID: `${ctx.from.id}@User@Telegram`,

                additionalInterfaceData: {
                    isDM: ctx.chat.type === "private",
                    isReply: ctx.message.reply_to_message !== undefined,
                    replyMessageID: ctx.message.reply_to_message?.message_id?.toString?.()
                }
            }
        })
    });

    logger.info("telegram", `Interface ${data.interfaceID} logged in.`);
    callback(null, {
        success: true
    });
});

cmc.on("api:logout", async (call_from: string, data: {
    interfaceID: number
}, callback: (error?: any, data?: any) => void) => {

});

cmc.on("api:send_message", async (call_from: string, data: IMessageData, callback: (error?: any, data?: any) => void) => {

});

cmc.on("api:get_userinfo", async (call_from: string, data: {
    interfaceID: number,
    userID: string
}, callback: (error?: any, data?: any) => void) => {

});

cmc.on("api:get_channelinfo", async (call_from: string, data: {
    interfaceID: number,
    channelID: string
}, callback: (error?: any, data?: any) => void) => {

});
