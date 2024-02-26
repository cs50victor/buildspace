'use client';

import { LoadingSVG } from '~/components/LoadingSVG';
import { ColorPicker } from '~/components/ColorPicker';
import { AudioInputTile } from '~/components/AudioInputTile';
import { ConfigurationPanelItem } from '~/components/ConfigurationPanelItem';
import { NameValueRow } from '~/components/NameValueRow';
import { PlaygroundTab, PlaygroundTabbedTile, PlaygroundTile } from '~/components/PlaygroundTile';
import { AgentMultibandAudioVisualizer } from '~/components/AgentMultibandAudioVisualizer';
import { useMultibandTrackVolume } from '~/hooks/useTrackVolume';
import { AgentState } from '~/lib/types';
import {
  TrackReference,
  VideoTrack,
  useChat,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useParticipantInfo,
  useRemoteParticipant,
  useRemoteParticipants,
  useTracks,
} from '@livekit/components-react';
import { ConnectionState, LocalParticipant, RoomEvent, Track } from 'livekit-client';
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './Button';

export enum PlaygroundOutputs {
  Video,
  Audio,
}

export interface PlaygroundMeta {
  name: string;
  value: string;
}

export interface PlaygroundProps {
  logo?: ReactNode;
  title?: string;
  githubLink?: string;
  themeColors: string[];
  defaultColor: string;
  outputs?: PlaygroundOutputs[];
  showQR?: boolean;
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
  metadata?: PlaygroundMeta[];
  videoFit?: 'contain' | 'cover';
}

const headerHeight = 56;

export default function Playground({
  outputs,
  themeColors,
  defaultColor,
  onConnect,
  metadata,
  videoFit,
}: PlaygroundProps) {
  const [agentState, setAgentState] = useState<AgentState>('offline');
  const [themeColor, setThemeColor] = useState(defaultColor);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const { localParticipant } = useLocalParticipant();

  const participants = useRemoteParticipants({
    updateOnlyOn: [RoomEvent.ParticipantMetadataChanged],
  });
  const agentParticipant = participants.find((p) => p.isAgent);

  const { send: sendChat, chatMessages } = useChat();
  const visualizerState = useMemo(() => {
    if (agentState === 'thinking') {
      return 'thinking';
    } else if (agentState === 'speaking') {
      return 'talking';
    }
    return 'idle';
  }, [agentState]);

  const roomState = useConnectionState();
  const tracks = useTracks();

  const agentAudioTrack = tracks.find(
    (trackRef) => trackRef.publication.kind === Track.Kind.Audio && trackRef.participant.isAgent,
  );

  const agentVideoTrack = tracks.find(
    (trackRef) => trackRef.publication.kind === Track.Kind.Video && trackRef.participant.isAgent,
  );

  const subscribedVolumes = useMultibandTrackVolume(agentAudioTrack?.publication.track, 5);

  const localTracks = tracks.filter(({ participant }) => participant instanceof LocalParticipant);
  const localVideoTrack = localTracks.find(({ source }) => source === Track.Source.Camera);
  const localMicTrack = localTracks.find(({ source }) => source === Track.Source.Microphone);

  const localMultibandVolume = useMultibandTrackVolume(localMicTrack?.publication.track, 20);

  useEffect(() => {
    if (!agentParticipant) {
      setAgentState('offline');
      return;
    }
    let agentMd: any = {};
    if (agentParticipant.metadata) {
      agentMd = JSON.parse(agentParticipant.metadata);
    }
    if (agentMd.agent_state) {
      setAgentState(agentMd.agent_state);
    } else {
      setAgentState('starting');
    }
  }, [agentParticipant, agentParticipant?.metadata]);

  const isAgentConnected = agentState !== 'offline';

  const onDataReceived = useCallback(
    (msg: any) => {
      if (msg.topic === 'transcription') {
        const decoded = JSON.parse(new TextDecoder('utf-8').decode(msg.payload));
        let timestamp = new Date().getTime();
        if ('timestamp' in decoded && decoded.timestamp > 0) {
          timestamp = decoded.timestamp;
        }
        setTranscripts([
          ...transcripts,
          {
            name: 'You',
            message: decoded.text,
            timestamp: timestamp,
            isSelf: true,
          },
        ]);
      }
    },
    [transcripts],
  );

  useDataChannel(onDataReceived);

  const mixedMediaContent = useMemo(() => {
    const videoFitClassName = `object-${videoFit}`;
    return (
      <MixedMedia
        {...{
          agentVideoTrack,
          agentAudioTrack,
          agentState,
          videoFit,
          subscribedVolumes,
          themeColor,
        }}
      />
    );
  }, [agentAudioTrack, subscribedVolumes, themeColor, agentState, agentVideoTrack, videoFit]);

  const settingsTileContent = useMemo(() => {
    return (
      <div className="flex flex-col gap-4 h-full w-full items-start overflow-y-auto">
        <ConfigurationPanelItem title="">
          <Button
            accentColor={roomState === ConnectionState.Connected ? 'red' : themeColor}
            disabled={roomState === ConnectionState.Connecting}
            onClick={() => onConnect(roomState === ConnectionState.Disconnected)}
          >
            {roomState === ConnectionState.Connecting ? (
              <LoadingSVG />
            ) : roomState === ConnectionState.Connected ? (
              'Disconnect'
            ) : (
              'Connect'
            )}
          </Button>
        </ConfigurationPanelItem>
        <ConfigurationPanelItem title="Settings">
          <div className="flex flex-col gap-2">
            {metadata?.map((data, index) => (
              <NameValueRow key={data.name + index} name={data.name} value={data.value} />
            ))}
          </div>
        </ConfigurationPanelItem>
        <ConfigurationPanelItem title="Status">
          <div className="flex flex-col gap-2">
            <NameValueRow
              name="Room connected"
              value={
                roomState === ConnectionState.Connecting ? (
                  <LoadingSVG diameter={16} strokeWidth={2} />
                ) : (
                  roomState
                )
              }
              valueColor={
                roomState === ConnectionState.Connected ? `${themeColor}-500` : 'gray-500'
              }
            />
            <NameValueRow
              name="Agent connected"
              value={
                isAgentConnected ? (
                  'true'
                ) : roomState === ConnectionState.Connected ? (
                  <LoadingSVG diameter={12} strokeWidth={2} />
                ) : (
                  'false'
                )
              }
              valueColor={isAgentConnected ? `${themeColor}-500` : 'gray-500'}
            />
            <NameValueRow
              name="Agent status"
              value={
                agentState !== 'offline' && agentState !== 'speaking' ? (
                  <div className="flex gap-2 items-center">
                    <LoadingSVG diameter={12} strokeWidth={2} />
                    {agentState}
                  </div>
                ) : (
                  agentState
                )
              }
              valueColor={agentState === 'speaking' ? `${themeColor}-500` : 'gray-500'}
            />
          </div>
        </ConfigurationPanelItem>
        {localVideoTrack && (
          <ConfigurationPanelItem title="Camera" deviceSelectorKind="videoinput">
            <div className="relative">
              <VideoTrack
                className="rounded-sm border border-gray-800 opacity-70 w-full"
                trackRef={localVideoTrack}
              />
            </div>
          </ConfigurationPanelItem>
        )}
        {localMicTrack && (
          <ConfigurationPanelItem title="Microphone" deviceSelectorKind="audioinput">
            <AudioInputTile frequencies={localMultibandVolume} />
          </ConfigurationPanelItem>
        )}
        <div className="w-full">
          <ConfigurationPanelItem title="Color">
            <ColorPicker
              colors={themeColors}
              selectedColor={themeColor}
              onSelect={(color) => {
                setThemeColor(color);
              }}
            />
          </ConfigurationPanelItem>
        </div>
      </div>
    );
  }, [
    agentState,
    isAgentConnected,
    localMicTrack,
    localMultibandVolume,
    localVideoTrack,
    metadata,
    roomState,
    themeColor,
    themeColors,
  ]);

  let mobileTabs: PlaygroundTab[] = [
    {
      title: 'Settings',
      content: (
        <PlaygroundTile
          padding={false}
          backgroundColor="gray-950"
          className="h-full w-full basis-1/4 items-start overflow-y-auto flex"
          childrenClassName="h-full grow items-start"
        >
          {settingsTileContent}
        </PlaygroundTile>
      ),
    },
  ];

  if (outputs?.includes(PlaygroundOutputs.Audio) || outputs?.includes(PlaygroundOutputs.Video)) {
    mobileTabs.push({
      title: 'Agent',
      content: (
        <PlaygroundTile className="w-full h-full grow" childrenClassName="justify-center">
          {mixedMediaContent}
        </PlaygroundTile>
      ),
    });
  }

  return (
    <>
      <div
        className={`flex gap-4 py-4 grow w-full selection:bg-${themeColor}-900`}
        style={{ height: `calc(100% - ${headerHeight}px)` }}
      >
        <div className="flex flex-col grow basis-1/2 gap-4 h-full lg:hidden">
          <PlaygroundTabbedTile
            className="h-full"
            tabs={mobileTabs}
            initialTab={mobileTabs.length - 1}
          />
        </div>
        <div
          className={`flex-col grow basis-1/2 gap-4 h-full hidden lg:${
            !outputs?.includes(PlaygroundOutputs.Audio) &&
            !outputs?.includes(PlaygroundOutputs.Video)
              ? 'hidden'
              : 'flex'
          }`}
        >
          {outputs?.includes(PlaygroundOutputs.Video) && (
            <PlaygroundTile
              title="Agent"
              className="w-full h-full grow"
              childrenClassName="justify-center"
            >
              {mixedMediaContent}
            </PlaygroundTile>
          )}
        </div>

        <PlaygroundTile
          padding={false}
          backgroundColor="gray-950"
          className="h-full w-full basis-1/4 items-start overflow-y-auto hidden max-w-[480px] lg:flex"
          childrenClassName="h-full grow items-start"
        >
          {settingsTileContent}
        </PlaygroundTile>
      </div>
    </>
  );
}

const MixedMedia = ({
  agentVideoTrack,
  agentAudioTrack,
  agentState,
  videoFit,
  subscribedVolumes,
  themeColor,
}: {
  themeColor: string;
  agentVideoTrack?: TrackReference;
  subscribedVolumes: Float32Array[];
  agentAudioTrack?: TrackReference;
  agentState: AgentState;
  videoFit: PlaygroundProps['videoFit'];
}) => {
  if (agentVideoTrack) {
    const videoFitClassName = `object-${videoFit}`;
    return (
      <div className="flex flex-col w-full grow text-gray-950 bg-black rounded-sm border border-gray-800 relative">
        <VideoTrack
          trackRef={agentVideoTrack}
          className={`absolute top-1/2 -translate-y-1/2 ${videoFitClassName} object-position-center w-full h-full`}
        />
      </div>
    );
  } else if (agentAudioTrack) {
    <div className="flex items-center justify-center w-full">
      <AgentMultibandAudioVisualizer
        state={agentState}
        barWidth={30}
        minBarHeight={30}
        maxBarHeight={150}
        accentColor={themeColor}
        accentShade={500}
        frequencies={subscribedVolumes}
        borderRadius={12}
        gap={16}
      />
    </div>;
  } else if (!agentAudioTrack) {
    return (
      <div className="flex items-center justify-center w-full">
        <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
          <LoadingSVG />
          Waiting for audio track
        </div>
      </div>
    );
  } else {
    return (
      <div className="flex flex-col w-full grow text-gray-950 bg-black rounded-sm border border-gray-800 relative">
        <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center h-full w-full">
          <LoadingSVG />
          Waiting for video track
        </div>
      </div>
    );
  }
};
