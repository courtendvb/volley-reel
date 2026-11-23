// Where a team's logo sits among a slide's pictures (by player key): under this key, next to the players'
// photos. The rotation slide and the serve-target slide put it at the top.
export const logoKey = (team: string) => `logo:${team.toUpperCase()}`
