/**
 * Every module manifest, for tooling and tests. The manifests live with the app
 * (src/modules/manifests/) so navigation and route guards can be built from the
 * modules shipped in a build.
 */
import { students } from "../../../src/modules/manifests/students";
import { attendance } from "../../../src/modules/manifests/attendance";
import { academics } from "../../../src/modules/manifests/academics";
import { fees } from "../../../src/modules/manifests/fees";
import { examinations } from "../../../src/modules/manifests/examinations";

export { students, attendance, academics, fees, examinations };
export const MANIFESTS = [students, attendance, academics, fees, examinations] as const;
