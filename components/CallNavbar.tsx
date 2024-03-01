import { Menubar, MenubarMenu, MenubarTrigger } from '~/components/ui/menubar';
import { TrackToggle, useConnectionState } from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { LoadingSVG } from './LoadingSVG';
import { PhoneIcon } from '@heroicons/react/24/solid';
import { tw } from '~/utils/tw';
import { PlaygroundDeviceSelector } from './PlaygroundDeviceSelector';

export const CallNavBar = ({
  className,
  handleConnect,
}: {
  className?: string;
  handleConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
}) => {
  const roomState = useConnectionState();

  return (
    <Menubar className={className}>
      <MenubarMenu>
        <TrackToggle
          className="p-2 bg-gray-900 text-gray-300 border border-gray-800 rounded-sm hover:bg-gray-800"
          source={Track.Source.Microphone}
        />
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger className="bg-transparent">
          <button
            className="bg-transparent"
            disabled={roomState === ConnectionState.Connecting}
            onClick={() => handleConnect(roomState === ConnectionState.Disconnected)}
          >
            {roomState === ConnectionState.Connecting ? (
              <LoadingSVG />
            ) : (
              <div
                className={tw(
                  'rounded-full p-2 transition-all duration-300',
                  roomState === ConnectionState.Connected ? 'bg-red-700' : 'bg-green-600',
                )}
              >
                <PhoneIcon
                  className={tw(
                    'w-5 h-5 text-white transition-all duration-300',
                    roomState === ConnectionState.Connected && 'rotate-[140deg]',
                  )}
                />
              </div>
            )}
          </button>
        </MenubarTrigger>
      </MenubarMenu>
      <MenubarMenu>
        <PlaygroundDeviceSelector kind="audioinput" />
      </MenubarMenu>
    </Menubar>
  );
};
