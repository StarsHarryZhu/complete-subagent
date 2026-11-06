/** The build inlines `styles.css` as one string module; this is its type. */
declare module '*.css' {
  const text: string
  export default text
}
