// esbuild 번들 진입점 — run.mjs 가 이 모듈의 run() 을 호출한다.
import { main } from './main';

export function run(argv: string[], writeCsv: (path: string, text: string) => void): number {
	return main(argv, writeCsv);
}
