import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

import type { VideoPlayerProps } from './VideoPlayer';

/** Web version: a plain YouTube iframe (react-native-webview has no web build). */
export function VideoPlayer({ youtubeId, aspectRatio = 9 / 16 }: VideoPlayerProps) {
  return (
    <View style={[styles.frame, { aspectRatio }]}>
      {createElement('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?playsinline=1&rel=0&modestbranding=1`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowFullScreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
        style: { border: 0, width: '100%', height: '100%' },
        title: 'video',
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
});
