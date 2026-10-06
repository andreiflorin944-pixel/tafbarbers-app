import { Redirect } from 'expo-router';

// Linkul „Programează” din Google Maps / Instagram (tafbarbers://book) deschide direct alegerea serviciului.
export default function BookLink() {
  return <Redirect href="/book/service" />;
}
