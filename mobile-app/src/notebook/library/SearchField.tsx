/**
 * The library search field (Figma input 'ابحث في المذكرات'): a search icon at the reading start, a
 * clear button at the end once something is typed. Searching matches notebook titles, folder names
 * and course codes and names (core/library/search.ts, through store.sections).
 */
import { useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/Icon';
import { tr } from '@/lib/i18n';
import { inputDir, row } from '@/lib/rtl';
import { colors, fonts } from '@/lib/theme';
import { nbRadius } from '@/notebook/theme';

export interface SearchFieldProps {
  value: string;
  onChange: (q: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

export function SearchField({ value, onChange, placeholder, style }: SearchFieldProps) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const label = placeholder ?? tr('ابحث في المذكرات', 'Search notebooks');
  return (
    <View style={[styles.box, { flexDirection: row }, style]}>
      <Icon name="search" size={18} color={colors.placeholder} />
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={label}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
        maxLength={200}
        style={[styles.input, inputDir()]}
      />
      {value ? (
        <Pressable
          onPress={() => {
            onChange('');
            input.current?.focus();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={tr('مسح البحث', 'Clear search')}
          style={styles.clear}>
          <Icon name="x" size={14} color={colors.surface} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    minHeight: 52,
    borderRadius: nbRadius.input,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: 12 },
  clear: { backgroundColor: colors.placeholder, borderRadius: 999, padding: 4 },
});
