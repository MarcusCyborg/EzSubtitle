import type { CaptionTrack } from '../types/transcript';
import { captionTrackDisplayLabel } from '../lib/youtube/caption-tracks';

type TrackSelectorProps = {
  tracks: CaptionTrack[];
  selectedTrack: CaptionTrack;
  disabled: boolean;
  onChange: (track: CaptionTrack) => void;
};

export function TrackSelector({ tracks, selectedTrack, disabled, onChange }: TrackSelectorProps) {
  return (
    <label className="track-selector">
      <span>Phụ đề</span>
      <select
        value={selectedTrack.id}
        disabled={disabled}
        onChange={(event) => {
          const track = tracks.find((candidate) => candidate.id === event.target.value);
          if (track) onChange(track);
        }}
      >
        {tracks.map((track) => (
          <option key={`${track.id}-${track.baseUrl}`} value={track.id}>
            {captionTrackDisplayLabel(track)}
          </option>
        ))}
      </select>
    </label>
  );
}
