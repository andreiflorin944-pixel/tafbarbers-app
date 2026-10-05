import { router } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, Screen, styles } from '@/components/ui';
import { useApp } from '@/state/AppState';
import { colors, space } from '@/theme';

// Mock phone login. The real version will send an SMS code through the
// Barberly accounts endpoint (key scope accounts:write) via our Worker.
export default function Login() {
  const { signIn } = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);

  const cleanPhone = phone.replace(/\s/g, '');
  const phoneOk = /^\+?\d{9,13}$/.test(cleanPhone) && name.trim().length >= 2;

  return (
    <Screen edges={['bottom']}>
      <Text style={styles.label}>Nume</Text>
      <TextInput value={name} onChangeText={setName} editable={!sent} placeholder="Numele tău" placeholderTextColor={colors.muted} style={styles.input} />
      <Text style={styles.label}>Telefon</Text>
      <TextInput value={phone} onChangeText={setPhone} editable={!sent} placeholder="07xx xxx xxx" placeholderTextColor={colors.muted} style={styles.input} keyboardType="phone-pad" />

      {sent ? (
        <>
          <Text style={styles.label}>Codul primit pe SMS</Text>
          <TextInput value={code} onChangeText={setCode} placeholder="1234" placeholderTextColor={colors.muted} style={styles.input} keyboardType="number-pad" maxLength={4} />
          <Text style={[styles.muted, { fontSize: 12, marginTop: space.xs }]}>Versiune de test: orice cod din 4 cifre e acceptat.</Text>
        </>
      ) : null}

      <View style={{ marginTop: space.lg }}>
        {sent ? (
          <Button
            title="Confirmă"
            disabled={code.length !== 4}
            onPress={() => {
              signIn({ name: name.trim(), phone: cleanPhone });
              router.back();
            }}
          />
        ) : (
          <Button title="Trimite codul" disabled={!phoneOk} onPress={() => setSent(true)} />
        )}
      </View>
    </Screen>
  );
}
