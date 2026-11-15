import {
  Pressable as RNPressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';

/**
 * React Native's Pressable with press feedback built in (D-202, ui-ux-pro-max `press-feedback`): the
 * control dims while held. Opacity only, so the layout never moves. A disabled control stays as styled.
 * Use this instead of importing Pressable from react-native.
 */
export function Pressable({ style, disabled, ...rest }: PressableProps) {
  return (
    <RNPressable
      disabled={disabled}
      style={(state: PressableStateCallbackType): StyleProp<ViewStyle> => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && !disabled ? styles.pressed : null,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({ pressed: { opacity: 0.6 } });
