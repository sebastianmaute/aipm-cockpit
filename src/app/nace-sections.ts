export type NaceSection = { code: string; title: string };

export const NACE_SECTIONS: readonly NaceSection[] = [
  { code: "A", title: "Agriculture, forestry and fishing" },
  { code: "B", title: "Mining and quarrying" },
  { code: "C", title: "Manufacturing" },
  { code: "D", title: "Electricity, gas, steam and air conditioning supply" },
  { code: "E", title: "Water supply; sewerage, waste management and remediation activities" },
  { code: "F", title: "Construction" },
  { code: "G", title: "Wholesale and retail trade; repair of motor vehicles and motorcycles" },
  { code: "H", title: "Transportation and storage" },
  { code: "I", title: "Accommodation and food service activities" },
  { code: "J", title: "Information and communication" },
  { code: "K", title: "Financial and insurance activities" },
  { code: "L", title: "Real estate activities" },
  { code: "M", title: "Professional, scientific and technical activities" },
  { code: "N", title: "Administrative and support service activities" },
  { code: "O", title: "Public administration and defence; compulsory social security" },
  { code: "P", title: "Education" },
  { code: "Q", title: "Human health and social work activities" },
  { code: "R", title: "Arts, entertainment and recreation" },
  { code: "S", title: "Other service activities" },
  { code: "T", title: "Activities of households as employers; undifferentiated goods- and services-producing activities of households for own use" },
  { code: "U", title: "Activities of extraterritorial organisations and bodies" },
];

export const NACE_SECTION_SET = new Set<string>(NACE_SECTIONS.map((s) => s.code));
