/** Source-adapter facts only; no HTML, image bytes, or semantic judgments. */
export interface ImagePart { filename: string | null; contentId?: string; disposition: string | null; mimeType: string; size: number }
export interface ImageReference { source: string }
export interface ContentObservations {
  htmlQuote: "none" | "clear" | "ambiguous";
  htmlCodeLines: number[];
  htmlCodeAmbiguous: boolean;
  images: ImageReference[];
  imageParts: ImagePart[];
  mimeComplete: boolean;
}
