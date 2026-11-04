import { useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';
import { Linking, StyleSheet } from 'react-native';
import RNWebView, { type WebViewNavigation, type WebViewProps } from 'react-native-webview';

interface WebViewInstance {
  injectJavaScript: (script: string) => void;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
}

// react-native-webview declares its class with a default generic of `undefined`, which turns
// the props into `never` under TypeScript 6. This alias restores the real props.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewInstance> }>;

export interface WebFrameHandle {
  inject: (js: string) => void;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  load: (url: string) => void;
}

export interface WebFrameNavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface WebFrameProps {
  ref?: Ref<WebFrameHandle>;
  uri: string;
  /** Runs after every page load */
  injectedJavaScript?: string;
  onMessage?: (data: string) => void;
  onNavigation?: (state: WebFrameNavState) => void;
  onProgress?: (progress: number) => void;
  /** Pages allowed inside the frame; anything else opens in the phone's browser. */
  allowUrl: (url: string) => boolean;
  /**
   * When set, pages outside `allowUrl` are not opened at all: this is called instead, so the
   * screen can offer to open them (used for Qeeem, whose ads and redirects should never pull
   * the student out of the app).
   */
  onBlocked?: (url: string) => void;
}

/** A website shown inside the app (portal, Qeeem). */
export function WebFrame({
  ref,
  uri,
  injectedJavaScript,
  onMessage,
  onNavigation,
  onProgress,
  allowUrl,
  onBlocked,
}: WebFrameProps) {
  const web = useRef<WebViewInstance>(null);

  useImperativeHandle(ref, () => ({
    inject: (js) => web.current?.injectJavaScript(js),
    reload: () => web.current?.reload(),
    goBack: () => web.current?.goBack(),
    goForward: () => web.current?.goForward(),
    load: (url) => web.current?.injectJavaScript(`window.location.href = ${JSON.stringify(url)}; true;`),
  }));

  const onNav = (nav: WebViewNavigation) =>
    onNavigation?.({ url: nav.url, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward, loading: nav.loading });

  return (
    <WebView
      ref={web}
      source={{ uri }}
      style={styles.web}
      originWhitelist={['https://*']}
      injectedJavaScript={injectedJavaScript}
      onMessage={(e) => onMessage?.(e.nativeEvent.data)}
      onNavigationStateChange={onNav}
      onLoadProgress={(e) => onProgress?.(e.nativeEvent.progress)}
      onShouldStartLoadWithRequest={(req) => {
        // Frames inside the page (Cloudflare's security check, embeds) load in place: they are
        // part of the page, never a reason to leave the app.
        if (req.isTopFrame === false) return true;
        if (allowUrl(req.url)) return true;
        if (onBlocked) {
          if (/^https?:/i.test(req.url)) onBlocked(req.url);
          return false;
        }
        // Other websites open in the phone's browser; app links (e.g. the Nafath app, tel:, mailto:)
        // open the matching app. Script and file URLs are never followed.
        if (!/^(javascript|data|file|blob|about|content):/i.test(req.url)) {
          Linking.openURL(req.url).catch(() => {});
        }
        return false;
      }}
      sharedCookiesEnabled
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#FFFFFF' },
});
