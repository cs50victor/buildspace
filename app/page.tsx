'use client';
import { generateRandomAlphanumeric } from '~/lib/util';
import { LiveKitRoom, RoomAudioRenderer, StartAudio, useToken } from '@livekit/components-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';

import Playground, { PlaygroundOutputs } from '~/components/Playground';
import { PlaygroundToast, ToastType } from '~/components/PlaygroundToast';
import { useAppConfig } from '~/hooks/useAppConfig';
import { CallNavBar } from '~/components/CallNavbar';

export default function Page() {
  const [toastMessage, setToastMessage] = useState<{
    message: string;
    type: ToastType;
  } | null>(null);
  const [shouldConnect, setShouldConnect] = useState(false);
  const [liveKitUrl, setLiveKitUrl] = useState(process.env.NEXT_PUBLIC_LIVEKIT_URL);

  const [roomName, setRoomName] = useState(createRoomName());

  const tokenOptions = useMemo(() => {
    return {
      userInfo: { identity: generateRandomAlphanumeric(16) },
    };
  }, []);

  // set a new room name each time the user disconnects so that a new token gets fetched behind the scenes for a different room
  useEffect(() => {
    if (shouldConnect === false) {
      setRoomName(createRoomName());
    }
  }, [shouldConnect]);

  const token = useToken('/api/get-participant-token', roomName, tokenOptions);

  const appConfig = useAppConfig();

  const outputs = [
    appConfig?.outputs.audio && PlaygroundOutputs.Audio,
    appConfig?.outputs.video && PlaygroundOutputs.Video,
  ].filter((item) => typeof item !== 'boolean') as PlaygroundOutputs[];

  const handleConnect = useCallback((connect: boolean, opts?: { url: string; token: string }) => {
    if (connect && opts) {
      setLiveKitUrl(opts.url);
    }
    setShouldConnect(connect);
  }, []);

  return (
    <main className="relative flex flex-col justify-center px-4 items-center h-full w-full bg-black repeating-square-background">
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            className="left-0 right-0 top-0 absolute z-10"
            initial={{ opacity: 0, translateY: -50 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -50 }}
          >
            <PlaygroundToast
              message={toastMessage.message}
              type={toastMessage.type}
              onDismiss={() => setToastMessage(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <LiveKitRoom
        className="flex flex-col h-full w-full"
        serverUrl={liveKitUrl}
        token={token}
        audio={appConfig.inputs.mic}
        video={false}
        connect={shouldConnect}
        onError={(e) => {
          setToastMessage({ message: e.message, type: 'error' });
          console.error(e);
        }}
      >
        <Playground
          agent_name={appConfig.agent_name}
          outputs={outputs}
          themeColor={appConfig.theme_color}
          onConnect={handleConnect}
          videoFit={appConfig.video_fit}
        />
        <RoomAudioRenderer />
        <StartAudio label="Click to enable audio playback" />
        <CallNavBar
          className="border-none bg-transparent [&>*:first-child]:bg-white [&>*:first-child]:rounded-full [&>*:first-child]:px-0 [&>*:first-child]:py-0 fixed bottom-6 mx-auto self-center"
          handleConnect={handleConnect}
        />
      </LiveKitRoom>
    </main>
  );
}

const createRoomName = () => {
  return [generateRandomAlphanumeric(4), generateRandomAlphanumeric(4)].join('-');
};
