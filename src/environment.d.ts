declare module "*.svg" {
  const path: string;
  export default path;
}
declare module "*.svg?raw" {
  const contents: string;
  export default contents;
}
declare module "*.png" {
  const path: string;
  export default path;
}
