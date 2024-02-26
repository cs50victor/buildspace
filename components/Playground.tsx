'use client';

import { LoadingSVG } from '~/components/LoadingSVG';
import { ConfigurationPanelItem } from '~/components/ConfigurationPanelItem';
import { NameValueRow } from '~/components/NameValueRow';
import { PlaygroundTile } from '~/components/PlaygroundTile';
import { AgentMultibandAudioVisualizer } from '~/components/AgentMultibandAudioVisualizer';
import { useMultibandTrackVolume } from '~/hooks/useTrackVolume';
import { AgentState } from '~/lib/types';
import {
  TrackReference,
  VideoTrack,
  useConnectionState,
  useDataChannel,
  useRemoteParticipants,
  useTracks,
} from '@livekit/components-react';
import { ConnectionState, LocalParticipant, RoomEvent, Track } from 'livekit-client';
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './Button';
import { Separator } from './ui/separator';

export enum PlaygroundOutputs {
  Video,
  Audio,
}

export interface PlaygroundProps {
  agent_name: string;
  themeColor: string;
  outputs?: PlaygroundOutputs[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
  videoFit?: 'contain' | 'cover';
}

const headerHeight = 56;

export default function Playground({ agent_name, outputs, themeColor, videoFit }: PlaygroundProps) {
  const [agentState, setAgentState] = useState<AgentState>('offline');
  const [transcripts, setTranscripts] = useState<any[]>([]);

  const participants = useRemoteParticipants({
    updateOnlyOn: [RoomEvent.ParticipantMetadataChanged],
  });
  const agentParticipant = participants.find((p) => p.isAgent);

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

  return (
    <>
      <div
        className={`flex gap-4 py-4 grow w-full selection:bg-${themeColor}-900`}
        style={{ height: `calc(100% - ${headerHeight}px)` }}
      >
        <PlaygroundTile
          title={agent_name}
          className="w-full h-full grow"
          childrenClassName="justify-center"
          status={
            <div className="ml-4 flex items-center justify-center space-x-3 text-inherit">
              <Separator className="h-3 text-gray-500" orientation="vertical" />
              <div className="flex space-x-3">
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
                <Separator className="h-3 text-gray-500" orientation="vertical" />
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
                <Separator className="h-3 text-gray-500" orientation="vertical" />
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
            </div>
          }
        >
          {mixedMediaContent}
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
    return (
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
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center w-full">
      <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        waiting for audio / video from buildspace AI
      </div>
    </div>
  );
};
