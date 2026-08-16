"use client";
import dynamic from "next/dynamic";
const KingdomGame = dynamic(() => import("@/components/KingdomGame"), { ssr: false });
export default function Home() { return <KingdomGame />; }
