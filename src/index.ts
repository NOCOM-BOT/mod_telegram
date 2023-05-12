import CMComm from "./CMC.js";
import Logger from "./Logger.js";

import fsSync from "fs";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";

import streamBuffers from "stream-buffers";

import { Telegraf } from 'telegraf';
import { Readable } from "stream";

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

let botIDs: {
    [id: number]: Telegraf
} = {};

cmc.on("api:login", async (call_from: string, data: {
    interfaceID: number;
    loginData: {
        botToken: string;
    }
}, callback: (error?: any, data?: any) => void) => {
    if (botIDs[data.interfaceID]) {
        callback("Interface ID already registered", {
            success: false
        });
        return;
    }

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
    bot.on("message", async (ctx) => {
        let content = "";
        let mentions: { [id: string]: { start: number, length: number } } = {};
        if ("text" in ctx.message) {
            content = ctx.message.text;
        }

        if ("entities" in ctx.message) {
            mentions = Object.fromEntries(
                (await Promise.all(
                    ctx.message.entities
                        ?.map?.(async e => {
                            switch (e.type) {
                                case "mention":
                                    // Resolve username to ID
                                    let username = content.substring(e.offset + 1, e.offset + e.length);
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
            );
        }

        let attachments: { filename: string, url: string }[] = [];
        if ("photo" in ctx.message) {
            // Telegram doesn't have a way to get the original photo 
            // because it's only transmitted compressed, so we'll just get the biggest one.
            let ids = [];
            for (let photo of ctx.message.photo) {
                if (!(ids.indexOf(photo.file_id) + 1)) {
                    ids.push(photo.file_id);
                }
            }

            // Get the biggest quality per file ID
            let biggest = ((await Promise.all(ids.map(async id => {
                if ("photo" in ctx.message) {
                    let qualities = ctx.message.photo
                        .filter(x => x.file_id == id)
                        .sort((a, b) => b.width - a.width);

                    return {
                        filename: qualities[0].file_id + ".jpg",
                        url: (await ctx.telegram.getFileLink(qualities[0].file_id)).href
                    }
                }
            }))).filter(x => x)) as any as { filename: string, url: string }[];

            attachments = attachments.concat(biggest);
        }

        if ("document" in ctx.message) {
            attachments.push({
                filename: ctx.message.document.file_name ?? "unknown",
                url: (await ctx.telegram.getFileLink(ctx.message.document.file_id)).href
            });
        }

        if ("sticker" in ctx.message) {
            attachments.push({
                filename: ctx.message.sticker.file_id + ".webp",
                url: (await ctx.telegram.getFileLink(ctx.message.sticker.file_id)).href
            });
        }

        if ("video" in ctx.message) {
            attachments.push({
                filename: ctx.message.video.file_name ?? "unknown.mp4",
                url: (await ctx.telegram.getFileLink(ctx.message.video.file_id)).href
            });
        }

        if ("voice" in ctx.message) {
            attachments.push({
                filename: ctx.message.voice.file_id + ".ogg",
                url: (await ctx.telegram.getFileLink(ctx.message.voice.file_id)).href
            });
        }

        if ("audio" in ctx.message) {
            attachments.push({
                filename: ctx.message.audio.file_name ?? "unknown.mp3",
                url: (await ctx.telegram.getFileLink(ctx.message.audio.file_id)).href
            });
        }

        if ("animation" in ctx.message) {
            attachments.push({
                filename: ctx.message.animation.file_name ?? "unknown.mp4",
                url: (await ctx.telegram.getFileLink(ctx.message.animation.file_id)).href
            });
        }

        if ("video_note" in ctx.message) {
            attachments.push({
                filename: ctx.message.video_note.file_id + ".mp4",
                url: (await ctx.telegram.getFileLink(ctx.message.video_note.file_id)).href
            });
        }

        let isReply = false;
        let replyMessageID: string | undefined = void 0;

        if ("reply_to_message" in ctx.message) {
            isReply = true;
            replyMessageID = ctx.message.reply_to_message?.message_id?.toString();
        }

        cmc.callAPI("core", "send_event", {
            eventName: "interface_message",
            data: {
                interfaceID: data.interfaceID,
                interfaceHandlerName: "Telegram",

                content,
                attachments,
                mentions,

                messageID: ctx.message.message_id.toString(),
                formattedMessageID: `${ctx.botInfo.id}_${ctx.message.message_id}@Message@Telegram`,
                channelID: ctx.chat.id.toString(),
                formattedChannelID: `${ctx.chat.id}@Channel@Telegram`,
                // Telegram doesn't have guilds, so we'll just use channel ID as guild ID.
                guildID: ctx.chat.id.toString(),
                formattedGuildID: `${ctx.chat.id}@Channel@Telegram`,
                senderID: ctx.from.id.toString(),
                formattedSenderID: `${ctx.from.id}@User@Telegram`,
                isDM: ctx.chat.type === "private",

                additionalInterfaceData: {
                    isReply,
                    replyMessageID
                }
            }
        });
    });

    botIDs[data.interfaceID] = bot;

    logger.info("telegram", `Interface ${data.interfaceID} logged in.`);
    callback(null, {
        success: true
    });
});

cmc.on("api:logout", async (call_from: string, data: {
    interfaceID: number
}, callback: (error?: any, data?: any) => void) => {
    if (botIDs[data.interfaceID]) {
        botIDs[data.interfaceID].stop();
    }

    callback(null, null);
});

cmc.on("api:send_message", async (call_from: string, data: IMessageData, callback: (error?: any, data?: any) => void) => {
    let bot = botIDs[data.interfaceID];
    if (!bot) {
        callback("Interface not logged in.");
        return;
    }

    let channelID = data.channelID?.split("@")[0];
    let channel = await bot.telegram.getChat(channelID);
    if (!channel) {
        callback("Channel not found.");
        return;
    }

    let replyMessageID = -1;
    let rIDSplit = (data.replyMessageID?.split("@")?.[0] ?? "").split("_");
    if (rIDSplit[0] === data.interfaceID.toString()) {
        replyMessageID = +rIDSplit[1];
    }

    let sentMessageID = "";
    if (data.attachments?.length) {
        if (data.attachments.length >= 2) {
            let sentMessage = await bot.telegram.sendMediaGroup(
                channelID,
                (
                    data.attachments
                        .map((attachment) => ({
                            filename: attachment.filename,
                            stream: convertURLToStream(attachment.url, attachment.filename)
                        }))
                        .filter(a => a.stream !== null) as { filename: string, stream: Readable }[]
                ).map((attachment) => ({
                    type: "document",
                    media: {
                        source: attachment.stream,
                        filename: attachment.filename
                    },
                    caption: data.content
                })),
                {
                    reply_to_message_id: replyMessageID,
                    allow_sending_without_reply: true
                }
            );
            sentMessageID = sentMessage[0].message_id.toString();
        } else {
            let attachment = data.attachments[0];
            let stream = convertURLToStream(attachment.url, attachment.filename);
            if (stream) {
                let sentMessage = await bot.telegram.sendDocument(channelID, {
                    source: stream,
                    filename: attachment.filename
                }, {
                    caption: data.content,
                    reply_to_message_id: replyMessageID,
                    allow_sending_without_reply: true
                });
                sentMessageID = sentMessage.message_id.toString();
            } else {
                let sentMessage = await bot.telegram.sendMessage(channelID, data.content, {
                    reply_to_message_id: replyMessageID,
                    allow_sending_without_reply: true
                });
                sentMessageID = sentMessage.message_id.toString();
            }
        }
    } else {
        let sentMessage = await bot.telegram.sendMessage(channelID, data.content, {
            reply_to_message_id: replyMessageID,
            allow_sending_without_reply: true
        });
        sentMessageID = sentMessage.message_id.toString();
    }

    callback(null, {
        messageID: sentMessageID.toString(),
        formattedMessageID: `${sentMessageID}@Message@Telegram`
    });
});

cmc.on("api:get_userinfo", async (call_from: string, data: {
    interfaceID: number,
    userID: string
}, callback: (error?: any, data?: any) => void) => {
    let bot = botIDs[data.interfaceID];
    if (!bot) {
        callback("Interface not logged in.");
        return;
    }

    let userID = data.userID.split("@")[0];
    let user = await bot.telegram.getChatMember(userID, +userID);
    if (!user) {
        callback("User not found.");
        return;
    }

    callback(null, {
        name: user.user.first_name + (user.user.last_name ? " " + user.user.last_name : ""),
        firstName: user.user.first_name,
        lastName: user.user.last_name
    });
});

cmc.on("api:get_channelinfo", async (call_from: string, data: {
    interfaceID: number,
    channelID: string
}, callback: (error?: any, data?: any) => void) => {
    let bot = botIDs[data.interfaceID];
    if (!bot) {
        callback("Interface not logged in.");
        return;
    }

    let channelID = data.channelID.split("@")[0];
    let channel = await bot.telegram.getChat(channelID);
    if (!channel) {
        callback("Channel not found.");
        return;
    }

    callback(null, {
        name: channel.type === "private" ? channel.first_name + (channel.last_name ? " " + channel.last_name : "") : channel.title
    });
});

function convertURLToStream(url: string, filename: string): Readable | null {
    if (url.startsWith("data:")) {
        // Check if it's base64-encoded or URL-encoded by checking if 
        // it has ";base64" in "data:<mime>;base64,<data>"
        if (url.split(";")[1].startsWith("base64")) {
            // Base64
            let buf = Buffer.from(url.split(",")[1], "base64");
            let stream = new streamBuffers.ReadableStreamBuffer({
                initialSize: buf.length
            });
            //@ts-ignore
            stream.path = attachment.filename;
            stream.put(buf);
            stream.stop();

            return stream;
        } else {
            // URL-encoded (percent-encoded)
            let buf = Buffer.from(decodeURIComponent(url.split(",")[1]));
            let stream = new streamBuffers.ReadableStreamBuffer({
                initialSize: buf.length
            });
            //@ts-ignore
            stream.path = attachment.filename;
            stream.put(buf);
            stream.stop();

            return stream;
        }
    } else {
        // Parse URL with protocol
        let parsedURL = new URL(url);
        switch (parsedURL.protocol) {
            case "http:":
                let httpReq = http.get(parsedURL.toString());
                if (filename) httpReq.path = filename;
                return httpReq as any as Readable;
            case "https:":
                let httpsReq = https.get(parsedURL.toString());
                if (filename) httpsReq.path = filename;
                return httpsReq as any as Readable;
            case "file:":
                let stream = fsSync.createReadStream(fileURLToPath(parsedURL.toString()));
                return stream;
            default:
                return null;
        }
    }
}
