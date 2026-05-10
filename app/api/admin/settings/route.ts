import { NextRequest, NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/store";

export async function GET(_req: NextRequest) {
  const settings = getSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const updated = updateSettings({
      randomRanking: body.randomRanking !== undefined ? Boolean(body.randomRanking) : undefined,
      inDegreeWeight: body.inDegreeWeight !== undefined ? parseFloat(body.inDegreeWeight) : undefined,
      outDegreeWeight: body.outDegreeWeight !== undefined ? parseFloat(body.outDegreeWeight) : undefined,
      homepagePageSize: body.homepagePageSize !== undefined ? Math.max(1, parseInt(body.homepagePageSize, 10)) : undefined,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
