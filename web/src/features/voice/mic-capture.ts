import { floatToPcm16le } from './pcm';

export type MicCapture = {
  stop: () => void;
};

type AudioContextCtor = typeof AudioContext;

export async function captureMicrophone(
  onFrame: (pcm: Uint8Array<ArrayBuffer>) => void,
  deps: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
    AudioContext?: AudioContextCtor;
  } = {},
): Promise<MicCapture> {
  const getUserMedia = deps.getUserMedia
    ?? navigator.mediaDevices?.getUserMedia.bind(navigator.mediaDevices);
  if (!getUserMedia) {
    throw new Error('Microphone is not available in this browser');
  }
  const Context = deps.AudioContext ?? window.AudioContext;
  const stream = await getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
  const context = new Context();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    onFrame(floatToPcm16le(input, context.sampleRate));
  };
  source.connect(processor);
  processor.connect(context.destination);
  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      void context.close();
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
