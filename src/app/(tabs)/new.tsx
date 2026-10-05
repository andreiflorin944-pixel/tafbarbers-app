import { Redirect } from 'expo-router';

// Placeholder route for the center "+" tab; the button itself opens /book/service.
export default function New() {
  return <Redirect href="/book/service" />;
}
