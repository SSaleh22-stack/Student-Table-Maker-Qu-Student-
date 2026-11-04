import type { ComponentType } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import RNWebView, { type WebViewProps } from 'react-native-webview';

// Same TypeScript 6 workaround as WebFrame: restore the real props.
const WebView = RNWebView as unknown as ComponentType<WebViewProps>;

export interface VideoPlayerProps {
  /** YouTube video id, e.g. "EIm0nSZxu2I" */
  youtubeId: string;
  /** width / height; 9/16 for Shorts */
  aspectRatio?: number;
}

/**
 * Plays a YouTube video inside the app. The embed is loaded from an HTML page with our site as
 * its base URL: YouTube refuses embeds that arrive without a referrer (error 153).
 */
export function VideoPlayer({ youtubeId, aspectRatio = 9 / 16 }: VideoPlayerProps) {
  const id = encodeURIComponent(youtubeId);
  const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
</head><body>
<iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&modestbranding=1"
  allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body></html>`;

  return (
    <View style={[styles.frame, { aspectRatio }]}>
      <WebView
        source={{ html, baseUrl: 'https://qustudent.net' }}
        style={styles.web}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        onShouldStartLoadWithRequest={(req) => {
          // The player itself loads in place; links out of it (the YouTube logo, "watch on
          // YouTube") open the YouTube app or browser instead of replacing the player.
          if (req.isTopFrame === false || req.url.startsWith('about:') || req.url === 'https://qustudent.net/') {
            return true;
          }
          if (/^https?:/i.test(req.url)) Linking.openURL(req.url).catch(() => {});
          return false;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
});
