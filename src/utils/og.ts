export const generateOgImage = (title: string) =>
  new URLSearchParams({
    title,
    author: "Jubayer Al Mamun",
    websiteUrl: "jubayeramb.me",
    avatar: "https://www.github.com/jubayeramb.png",
    theme: "default",
  }).toString();
