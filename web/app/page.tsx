import Dashboard from '@/components/dashboard';
export default function Home() {
  return <Dashboard initialDay={new Date().toISOString().slice(0, 10)} />;
}
