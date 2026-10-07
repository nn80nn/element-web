/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventEmitter } from "events";
import { type MatrixClient, type RoomMember } from "matrix-js-sdk/src/matrix";

import { CallEvent } from "../../src/models/Call";
import { CallStoreEvent } from "../../src/stores/CallStore";
import { VoiceChannelSounds } from "../../src/VoiceChannelSounds";
import SettingsStore from "../../src/settings/SettingsStore";

const member = (userId: string): RoomMember => ({ userId }) as RoomMember;
const participants = (...ids: string[]): Map<RoomMember, Set<string>> =>
    new Map(ids.map((id) => [member(id), new Set(["DEVICE"])]));

describe("VoiceChannelSounds", () => {
    let call: EventEmitter & { roomId: string; participants: Map<RoomMember, Set<string>> };
    let store: EventEmitter & { getAllCalls: jest.Mock; getActiveCall: jest.Mock };
    let client: MatrixClient;
    let isVideoRoom: boolean;
    let sounds: VoiceChannelSounds;
    let played: string[];

    beforeEach(() => {
        jest.spyOn(Date, "now").mockReturnValue(1_000_000);
        isVideoRoom = true;
        played = [];
        jest.spyOn(window, "Audio").mockImplementation(
            () =>
                ({
                    canPlayType: () => "probably",
                    play: jest.fn().mockImplementation(function (this: { src: string }) {
                        played.push(this.src);
                        return Promise.resolve();
                    }),
                }) as unknown as HTMLAudioElement,
        );
        jest.spyOn(SettingsStore, "getValue").mockReturnValue(true);

        call = Object.assign(new EventEmitter(), { roomId: "!room:example.org", participants: participants("@a:x") });
        store = Object.assign(new EventEmitter(), {
            getAllCalls: jest.fn().mockReturnValue(new Map([[call.roomId, call]])),
            getActiveCall: jest.fn().mockReturnValue(null),
        });
        client = {
            getSafeUserId: () => "@me:x",
            getRoom: () => ({ isElementVideoRoom: () => isVideoRoom, isCallRoom: () => false }),
        } as unknown as MatrixClient;

        sounds = new VoiceChannelSounds();
        sounds.start(store as never, client);
    });

    afterEach(() => {
        sounds.stop();
        jest.restoreAllMocks();
    });

    const change = (now: Map<RoomMember, Set<string>>): void => {
        const before = call.participants;
        call.participants = now;
        call.emit(CallEvent.Participants, now, before);
    };

    it("plays a sound when someone joins a voice channel", () => {
        change(participants("@a:x", "@b:x"));
        expect(played).toHaveLength(1);
        expect(played[0]).toContain("call_join");
    });

    it("plays a different sound when someone leaves", () => {
        change(participants());
        expect(played).toHaveLength(1);
        expect(played[0]).toContain("call_leave");
    });

    it("stays quiet about our own joins and leaves", () => {
        change(participants("@a:x", "@me:x"));
        expect(played).toHaveLength(0);
    });

    it("stays quiet in a call we are in, where Element Call makes the sounds", () => {
        store.getActiveCall.mockReturnValue(call);
        change(participants("@a:x", "@b:x"));
        expect(played).toHaveLength(0);
    });

    it("stays quiet for rooms that are not voice channels", () => {
        isVideoRoom = false;
        change(participants("@a:x", "@b:x"));
        expect(played).toHaveLength(0);
    });

    it("respects the setting", () => {
        jest.spyOn(SettingsStore, "getValue").mockReturnValue(false);
        change(participants("@a:x", "@b:x"));
        expect(played).toHaveLength(0);
    });

    it("copes with the store reporting a room that has no call", () => {
        expect(() => store.emit(CallStoreEvent.Call, null, "!empty:example.org")).not.toThrow();
    });

    it("starts watching calls that appear later", () => {
        const later = Object.assign(new EventEmitter(), {
            roomId: "!later:example.org",
            participants: participants(),
        });
        store.emit(CallStoreEvent.Call, later, later.roomId);
        const before = later.participants;
        later.participants = participants("@b:x");
        later.emit(CallEvent.Participants, later.participants, before);
        expect(played).toHaveLength(1);
    });

    it("does not stack up sounds for a burst of changes", () => {
        change(participants("@a:x", "@b:x"));
        change(participants("@a:x", "@b:x", "@c:x"));
        expect(played).toHaveLength(1);
    });
});
