import { Redirect } from 'expo-router';

// Placeholder route for the center "+" tab; the button itself opens /book/location (primul pas: locația).
export default function New() {
  return <Redirect href="/book/location" />;
}
