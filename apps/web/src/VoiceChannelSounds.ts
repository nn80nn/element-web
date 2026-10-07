/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { MatrixClient, RoomMember } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { type Call, CallEvent } from "./models/Call";
import SettingsStore from "./settings/SettingsStore";
import { type CallStore, CallStoreEvent } from "./stores/CallStore";
import { isVideoRoom } from "./utils/video-rooms";

/** Quick joins and leaves (a flapping connection, say) shouldn't turn into a wall of sound. */
const MIN_GAP_MS = 800;

/**
 * Plays a short sound when someone joins or leaves a voice channel (a video room) that
 * you aren't currently in yourself. While you are in the call, Element Call plays its own
 * sounds, so staying silent here avoids hearing everything twice.
 *
 * Nothing should be calling any methods on it apart from start / stop.
 */
export class VoiceChannelSounds {
    private callStore: CallStore | undefined;
    private matrixClient: MatrixClient | undefined;
    /** The participants listener attached to each call we are watching. */
    private readonly listeners = new Map<
        Call,
        (now: Map<RoomMember, Set<string>>, before: Map<RoomMember, Set<string>>) => void
    >();
    private lastPlayed = 0;

    public static sharedInstance(): VoiceChannelSounds {
        if (!window.mxVoiceChannelSounds) window.mxVoiceChannelSounds = new VoiceChannelSounds();
        return window.mxVoiceChannelSounds;
    }

    public start(callStore: CallStore, matrixClient: MatrixClient): void {
        this.callStore = callStore;
        this.matrixClient = matrixClient;

        callStore.on(CallStoreEvent.Call, this.onCall);
        for (const call of callStore.getAllCalls().values()) this.track(call);
    }

    public stop(): void {
        this.callStore?.off(CallStoreEvent.Call, this.onCall);
        for (const call of [...this.listeners.keys()]) this.untrack(call);
        this.callStore = undefined;
        this.matrixClient = undefined;
    }

    private onCall = (call: Call): void => {
        this.track(call);
    };

    private track(call: Call): void {
        if (this.listeners.has(call)) return;
        // Only changes after this point are announced, so the people already in a call when
        // we start up are not greeted one by one.
        const listener = (now: Map<RoomMember, Set<string>>, before: Map<RoomMember, Set<string>>): void =>
            this.announce(call, this.userIds(before), this.userIds(now));
        this.listeners.set(call, listener);
        call.on(CallEvent.Participants, listener);
        call.once(CallEvent.Destroy, () => this.untrack(call));
    }

    private untrack(call: Call): void {
        const listener = this.listeners.get(call);
        if (listener) call.off(CallEvent.Participants, listener);
        this.listeners.delete(call);
    }

    private userIds(participants: Map<RoomMember, Set<string>>): Set<string> {
        return new Set([...participants.keys()].map((member) => member.userId));
    }

    private announce(call: Call, before: Set<string>, after: Set<string>): void {
        const client = this.matrixClient;
        if (!client || !this.callStore) return;
        if (!SettingsStore.getValue("voiceChannelSounds")) return;

        const room = client.getRoom(call.roomId);
        if (!room || !isVideoRoom(room)) return;
        // Element Call is already making these sounds for the call we are in.
        if (this.callStore.getActiveCall(call.roomId)) return;

        const me = client.getSafeUserId();
        const joined = [...after].some((id) => id !== me && !before.has(id));
        const left = [...before].some((id) => id !== me && !after.has(id));
        if (joined) this.play("call_join");
        else if (left) this.play("call_leave");
    }

    private play(name: "call_join" | "call_leave"): void {
        const now = Date.now();
        if (now - this.lastPlayed < MIN_GAP_MS) return;
        this.lastPlayed = now;

        const audio = new Audio();
        audio.src = `./media/${name}.${audio.canPlayType("audio/ogg; codecs=vorbis") ? "ogg" : "mp3"}`;
        audio.play().catch((e) => logger.warn("Could not play voice channel sound", e));
    }
}
