import { Image, StyleSheet, View } from 'react-native';
import { mediaUrl } from '@/api/staff';
import { backdrop } from '@/theme';

/** Poza de fundal din panou, întunecată cât s-a setat. Se pune prima în ecran, sub conținut. */
export function Backdrop() {
  if (!backdrop.image) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={{ uri: mediaUrl(backdrop.image)! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${backdrop.dim / 100})` }]} />
    </View>
  );
}
