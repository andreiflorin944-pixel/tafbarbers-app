import { Redirect } from 'expo-router';

// Butonul „+” din bară deschide direct ecranul de programare nouă; ruta există doar pentru tab.
export default function Add() {
  return <Redirect href="/staff/new" />;
}
