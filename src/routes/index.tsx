import { createFileRoute } from "@tanstack/react-router";
import { TunnelGame } from "@/components/TunnelGame";

export const Route = createFileRoute("/")({
	component: App,
});

function App() {
	return <TunnelGame />;
}
